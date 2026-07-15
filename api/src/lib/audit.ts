import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

/**
 * Admin audit trail (DATABASE_SCHEMA §2.16). Append-only (row trigger);
 * written inside the same transaction as the change it records whenever a
 * transaction exists, so an audit row never describes a change that rolled
 * back. Order/payment moves are audited in order_status_history and stock
 * moves in stock_adjustments — this table covers everything else.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type AdminAction =
  | "product.create"
  | "product.update"
  | "product.archive"
  | "product.delete"
  | "image.upload"
  | "image.delete"
  | "image.primary"
  | "category.create"
  | "category.update"
  | "category.delete"
  | "category.reassign"
  | "user.block"
  | "user.unblock"
  | "settings.update";

export function recordAdminAction(
  db: Db,
  row: {
    actorId: bigint;
    action: AdminAction;
    targetType: "product" | "image" | "category" | "user" | "settings";
    targetId?: bigint | string | null;
    details?: Prisma.InputJsonValue;
  },
) {
  return db.adminAuditLog.create({
    data: {
      actorId: row.actorId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId === undefined || row.targetId === null ? null : row.targetId.toString(),
      details: row.details,
    },
  });
}
