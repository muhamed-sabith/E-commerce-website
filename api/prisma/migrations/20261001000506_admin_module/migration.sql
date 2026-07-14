-- AlterTable
ALTER TABLE "users" ADD COLUMN     "blocked_at" TIMESTAMPTZ(6),
ADD COLUMN     "blocked_reason" VARCHAR(255);

-- CreateTable
CREATE TABLE "store_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "low_stock_threshold" INTEGER NOT NULL,
    "shipping_flat_rate" DECIMAL(10,2) NOT NULL,
    "shipping_free_threshold" DECIMAL(10,2) NOT NULL,
    "default_sort" VARCHAR(12) NOT NULL,
    "page_size" INTEGER NOT NULL,
    "updated_by" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_audit_log" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" BIGINT NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "target_type" VARCHAR(20) NOT NULL,
    "target_id" VARCHAR(40),
    "details" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_audit_log_target_type_target_id_idx" ON "admin_audit_log"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "admin_audit_log_created_at_idx" ON "admin_audit_log"("created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "admin_audit_log" ADD CONSTRAINT "admin_audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- =====================================================================
-- Phase 10 invariants (docs/DATABASE_SCHEMA.md §2.1, §2.15, §2.16)
-- =====================================================================

-- users: a block always carries its reason and timestamp; unblocked rows carry neither.
-- Rows blocked before this migration (no reason captured) get an honest backfill.
UPDATE "users" SET "blocked_reason" = 'Blocked before reasons were recorded', "blocked_at" = "updated_at"
  WHERE "is_blocked" = true AND "blocked_reason" IS NULL;
ALTER TABLE "users" ADD CONSTRAINT "users_block_reason_check"
  CHECK (
    ("is_blocked" = false AND "blocked_reason" IS NULL AND "blocked_at" IS NULL)
    OR ("is_blocked" = true AND "blocked_reason" IS NOT NULL AND btrim("blocked_reason") <> '' AND "blocked_at" IS NOT NULL)
  );

-- store_settings: a single row of validated operational values.
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_singleton_check" CHECK ("id" = 1);
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_values_check"
  CHECK (
    "low_stock_threshold" BETWEEN 0 AND 1000
    AND "shipping_flat_rate" >= 0
    AND "shipping_free_threshold" >= 0
    AND "default_sort" IN ('newest','price_asc','price_desc','name_asc','name_desc')
    AND "page_size" BETWEEN 4 AND 48
  );

-- admin_audit_log: append-only, like the other audit tables.
CREATE TRIGGER "admin_audit_log_append_only"
  BEFORE UPDATE OR DELETE ON "admin_audit_log"
  FOR EACH ROW EXECUTE FUNCTION heyrah_reject_mutation();
